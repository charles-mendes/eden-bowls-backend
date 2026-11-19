const { CustomerPurchaseTrailService } = require('../src/services/customer-purchase-trail.service');

const CORRELATION = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

function fakeRepository() {
  let nextId = 1;
  const attempts = new Map();
  const repository = {
    events: [],
    configEvents: [],
    attempts,
    openAttempt: jest.fn(async (row) => {
      const key = `${row.user_id}|${row.market}|${row.correlation_id}`;
      if (!attempts.has(key)) {
        attempts.set(key, { id: nextId++, status: 'in_progress', ...row });
      } else {
        const current = attempts.get(key);
        for (const [field, value] of Object.entries(row)) {
          if (value != null) current[field] = value;
        }
      }
      return attempts.get(key).id;
    }),
    insertEvent: jest.fn(async (row) => { repository.events.push(row); return 1; }),
    insertConfigEvent: jest.fn(async (row) => { repository.configEvents.push(row); }),
    transitionAttempt: jest.fn(async (id, transition, fields) => {
      const row = [...attempts.values()].find((item) => item.id === id);
      if (!row || row.status === 'paid') return 0;
      row.status = transition;
      row.error_code = transition === 'paid' ? null : fields.error_code;
      return 1;
    }),
    findAttemptForPayment: jest.fn(async ({ userId, market, subscriptionId, attemptId }) => [...attempts.values()].find((row) => row.user_id === userId
      && row.market === market
      && ((subscriptionId && row.subscription_id === subscriptionId) || (attemptId && row.attempt_id === attemptId))) || null),
    deleteOlderThan: jest.fn(async () => ({ attempts: 0, events: 0, config_events: 0 }))
  };
  return repository;
}

function service(overrides = {}) {
  const repository = overrides.repository || fakeRepository();
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
  return {
    repository,
    logger,
    trail: new CustomerPurchaseTrailService({ repository, logger, ledgerRepository: overrides.ledgerRepository, now: overrides.now })
  };
}

// customer-purchase-trail
describe('CustomerPurchaseTrailService', () => {
  test('a step without a user or a market writes nothing', async () => {
    const { trail, repository } = service();
    await trail.recordStep({ market: 'br', area: 'onboarding', step: 'pet_create', outcome: 'failed' });
    await trail.recordStep({ userId: 5, area: 'onboarding', step: 'pet_create', outcome: 'failed' });
    expect(repository.openAttempt).not.toHaveBeenCalled();
  });

  test('only allowlisted fields reach the insert, whatever the caller passes', async () => {
    const { trail, repository } = service();
    await trail.recordStep({
      userId: 5,
      market: 'br',
      area: 'checkout',
      step: 'subscription_checkout',
      outcome: 'failed',
      correlationId: CORRELATION,
      fields: { attemptId: 'att_1', cpf: '12345678900', client_secret: 'pi_x_secret_y', payment_method: 'pm_1' },
      error: { code: 'invalid_coupon', message: 'x'.repeat(900), httpStatus: 409 },
      body: { cpf: '12345678900' }
    });
    const written = JSON.stringify([...repository.attempts.values(), ...repository.events]);
    expect(written).not.toContain('12345678900');
    expect(written).not.toContain('secret');
    expect(written).not.toContain('pm_1');
    expect(repository.events[0].error_message).toHaveLength(500);
    expect(repository.events[0]).toMatchObject({ user_id: 5, market: 'br', error_code: 'invalid_coupon', http_status: 409 });
  });

  test('the same correlation in the other market is another attempt', async () => {
    const { trail, repository } = service();
    await trail.recordStep({ userId: 5, market: 'br', area: 'plan', step: 'plan_selection', outcome: 'ok', correlationId: CORRELATION });
    await trail.recordStep({ userId: 5, market: 'us', area: 'plan', step: 'plan_selection', outcome: 'ok', correlationId: CORRELATION });
    expect(repository.attempts.size).toBe(2);
    expect(repository.events.map((event) => event.attempt_row_id)).toEqual([1, 2]);
  });

  test('an invalid or missing correlation becomes a server UUID, never the attempt id', async () => {
    const { trail, repository } = service();
    const result = await trail.recordStep({
      userId: 5, market: 'us', area: 'checkout', step: 'shipping', outcome: 'failed', correlationId: 'att_123', fields: { attemptId: 'att_123' }
    });
    expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.correlationId).not.toBe('att_123');
  });

  test('an intermediate failure keeps the attempt in progress, and paid replaces a failed one', async () => {
    const { trail, repository } = service();
    const base = { userId: 5, market: 'br', area: 'checkout', correlationId: CORRELATION };
    await trail.recordStep({ ...base, step: 'zipcode_lookup', outcome: 'failed', error: { code: 'invalid_zipcode' } });
    const attempt = [...repository.attempts.values()][0];
    expect(attempt.status).toBe('in_progress');
    await trail.recordStep({ ...base, step: 'subscription_checkout', outcome: 'failed', transition: 'failed', error: { code: 'stripe_subscription_failed' } });
    expect(attempt.status).toBe('failed');
    await trail.recordStep({ ...base, step: 'payment_intent_ack', outcome: 'ok', transition: 'paid' });
    expect(attempt.status).toBe('paid');
    await trail.recordStep({ ...base, step: 'confirm_card_payment', outcome: 'failed', transition: 'failed' });
    expect(attempt.status).toBe('paid');
  });

  test('a subscription change closes completed', async () => {
    const { trail, repository } = service();
    await trail.recordStep({ userId: 5, market: 'us', area: 'subscription', step: 'edit_commit', outcome: 'ok', transition: 'completed', fields: { subscriptionId: 'sub_1' } });
    expect([...repository.attempts.values()][0].status).toBe('completed');
  });

  test('a failing insert is logged and swallowed', async () => {
    const repository = fakeRepository();
    repository.openAttempt.mockRejectedValue(new Error('db down'));
    const { trail, logger } = service({ repository });
    await expect(trail.recordStep({ userId: 5, market: 'us', area: 'plan', step: 'recurrence', outcome: 'ok' })).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('the address country wins over the page market', async () => {
    const ledgerRepository = { findUserStateByUserId: jest.fn(async () => ({ address: { country: 'US' } })) };
    const { trail } = service({ ledgerRepository });
    await expect(trail.resolveCustomerMarket(5, 'br')).resolves.toBe('us');
    ledgerRepository.findUserStateByUserId.mockResolvedValue(null);
    await expect(trail.resolveCustomerMarket(5, 'br')).resolves.toBe('br');
    await expect(trail.resolveCustomerMarket(5, '')).resolves.toBe('');
  });

  test('a config event has no customer user id', async () => {
    const { trail, repository } = service();
    await trail.recordConfig({ market: 'us', actorId: 2, action: 'first_purchase_coupon.create', outcome: 'ok', targetRef: 'promo_1' });
    expect(repository.configEvents[0]).toEqual({
      market: 'us', stripe_account: 'us', actor_admin_id: 2, action: 'first_purchase_coupon.create', target_ref: 'promo_1', outcome: 'ok', error_code: null
    });
    expect(repository.configEvents[0]).not.toHaveProperty('user_id');
  });

  test('retention uses one 180-day cutoff', async () => {
    const { trail, repository } = service({ now: () => new Date('2026-11-19T00:00:00Z') });
    await trail.purgeExpired();
    expect(repository.deleteOlderThan).toHaveBeenCalledWith(new Date('2026-05-23T00:00:00Z'), 1000);
  });
});
