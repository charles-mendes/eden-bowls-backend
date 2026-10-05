const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');
const { usCalendarCoveredThrough } = require('../src/core/delivery-closed-days');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = (userId) => issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const OPERATOR = { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['US'] };
const READONLY = { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['US'] };

const carrier = (closedOn) => ({ market: 'US', closedOn, type: 'carrier', active: true, closesPreparation: true, closesPickup: true, closesDelivery: true });
const UPS_2027 = ['2027-01-01', '2027-01-18', '2027-05-31', '2027-12-25', '2028-01-01'].map(carrier);

function sync(overrides = {}) {
  return {
    id: 1, stripeSubscriptionId: 'sub_1', market: 'US', auditEventId: 70,
    expectedTrialEnd: '2027-12-21T05:00:00.000Z', targetTrialEnd: '2027-12-22T05:00:00.000Z', foundTrialEnd: null,
    status: 'pending', attempts: 0, lastError: null, createdAt: '2027-12-10T14:00:00.000Z', ...overrides
  };
}

function setup({ identity = OPERATOR, now = new Date('2027-12-10T15:00:00Z'), rows = UPS_2027, syncs = [], stripeTrialEnd = null } = {}) {
  const syncsRepository = {
    listForPanel: jest.fn().mockResolvedValue(syncs),
    findById: jest.fn(async (id) => syncs.find((row) => row.id === id) || null),
    reopen: jest.fn().mockResolvedValue(true),
    setFound: jest.fn()
  };
  const auditRepository = {
    createIn: jest.fn().mockResolvedValue(9100),
    findById: jest.fn().mockResolvedValue({ id: 70, metadata: { closedOn: '2027-12-21' } })
  };
  const billing = { retrieveSubscription: jest.fn().mockResolvedValue({ trial_end: stripeTrialEnd == null ? null : Math.floor(Date.parse(stripeTrialEnd) / 1000) }) };
  const service = new AdminDeliveryCalendarService({
    calendarRepository: { listActive: jest.fn().mockResolvedValue(rows) },
    syncsRepository,
    auditRepository,
    billingFor: jest.fn(() => billing),
    dataSource: { transaction: (work) => work({ query: jest.fn() }) },
    syncDelayMinutes: 15,
    now: () => now
  });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminDeliveryCalendarService: service
  });
  return { app, syncsRepository, auditRepository, billing };
}

describe('GET /api/v1/admin/delivery-calendar/syncs', () => {
  test('splits delayed pending rows from failed and conflict rows, for readonly too', async () => {
    const rows = [sync(), sync({ id: 2, status: 'failed', attempts: 8, lastError: 'timeout' }), sync({ id: 3, status: 'conflict', foundTrialEnd: '2028-01-24T05:00:00.000Z' })];
    const { app, syncsRepository } = setup({ identity: READONLY, syncs: rows });
    const response = await request(app).get('/api/v1/admin/delivery-calendar/syncs?market=US').set('Authorization', `Bearer ${token(9)}`);
    expect(response.status).toBe(200);
    expect(syncsRepository.listForPanel).toHaveBeenCalledWith('US', { now: new Date('2027-12-10T15:00:00Z'), delayMinutes: 15 });
    expect(response.body.delayed.map((row) => row.id)).toEqual([1]);
    expect(response.body.problems.map((row) => [row.id, row.status, row.foundTrialEnd])).toEqual([
      [2, 'failed', null],
      [3, 'conflict', '2028-01-24T05:00:00.000Z']
    ]);
  });
});

describe('UPS calendar coverage alert', () => {
  test('the covered end ignores a lone 1 January', () => {
    expect(usCalendarCoveredThrough(UPS_2027)).toBe('2027-12-31');
    expect(usCalendarCoveredThrough([carrier('2028-01-01')])).toBeNull();
    expect(usCalendarCoveredThrough([])).toBeNull();
  });

  test.each([
    ['2027-10-15T15:00:00Z', true, '2027-12-31', UPS_2027],
    ['2026-10-05T15:00:00Z', false, '2027-12-31', UPS_2027],
    ['2027-10-15T15:00:00Z', true, null, [carrier('2028-01-01')]],
    ['2026-10-05T15:00:00Z', true, null, []]
  ])('on %s the warning is %s (covered through %s)', async (now, warn, coveredThrough, rows) => {
    const { app } = setup({ now: new Date(now), rows });
    const response = await request(app).get('/api/v1/admin/delivery-calendar/alerts?market=US').set('Authorization', `Bearer ${token(8)}`);
    expect(response.status).toBe(200);
    expect(response.body.upsCalendar).toMatchObject({ warn, coveredThrough });
  });

  test('the warning starts under 90 days before the covered end', async () => {
    const at = async (now) => (await request(setup({ now: new Date(now) }).app)
      .get('/api/v1/admin/delivery-calendar/alerts?market=US').set('Authorization', `Bearer ${token(8)}`)).body.upsCalendar;
    expect(await at('2027-10-02T15:00:00Z')).toMatchObject({ daysLeft: 90, warn: false, missingYear: 2028 });
    expect(await at('2027-10-03T15:00:00Z')).toMatchObject({ daysLeft: 89, warn: true });
  });
});

describe('POST /api/v1/admin/delivery-calendar/syncs/:id/resend', () => {
  const send = (app, id, body = {}, user = token(8)) => request(app)
    .post(`/api/v1/admin/delivery-calendar/syncs/${id}/resend`).set('Authorization', `Bearer ${user}`).send({ market: 'US', ...body });

  test('a failed sync goes back to pending and the resend is audited', async () => {
    const { app, syncsRepository, auditRepository, billing } = setup({ syncs: [sync({ status: 'failed', attempts: 8 })] });
    const response = await send(app, 1);
    expect(response.status).toBe(200);
    expect(syncsRepository.reopen).toHaveBeenCalledWith(expect.anything(), 1, { fromStatus: 'failed', expectedTrialEnd: undefined, now: expect.any(Date) });
    expect(billing.retrieveSubscription).not.toHaveBeenCalled();
    expect(auditRepository.createIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'delivery_calendar.sync_resend',
      metadata: expect.objectContaining({ closedOn: '2027-12-21', syncId: 1, previousStatus: 'failed', targetTrialEnd: '2027-12-22T05:00:00.000Z' })
    }));
  });

  test('a conflict resends over the found value only while Stripe still has it', async () => {
    const found = '2028-01-24T05:00:00.000Z';
    const { app, syncsRepository } = setup({ syncs: [sync({ status: 'conflict', foundTrialEnd: found })], stripeTrialEnd: found });
    const response = await send(app, 1, { foundTrialEnd: found });
    expect(response.status).toBe(200);
    expect(syncsRepository.reopen).toHaveBeenCalledWith(expect.anything(), 1, { fromStatus: 'conflict', expectedTrialEnd: found, now: expect.any(Date) });
  });

  test('a conflict whose Stripe value changed again is refused and stores the new value', async () => {
    const found = '2028-01-24T05:00:00.000Z';
    const newer = '2028-01-31T05:00:00.000Z';
    const { app, syncsRepository, auditRepository } = setup({ syncs: [sync({ status: 'conflict', foundTrialEnd: found })], stripeTrialEnd: newer });
    const response = await send(app, 1, { foundTrialEnd: found });
    expect(response.status).toBe(409);
    expect(response.body.details).toEqual({ code: 'sync_conflict_changed', foundTrialEnd: newer });
    expect(syncsRepository.setFound).toHaveBeenCalledWith(1, newer);
    expect(syncsRepository.reopen).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
  });

  test('a conflict resend must carry the value the operator saw', async () => {
    const { app } = setup({ syncs: [sync({ status: 'conflict', foundTrialEnd: '2028-01-24T05:00:00.000Z' })] });
    expect((await send(app, 1)).body.details.code).toBe('sync_conflict_changed');
  });

  test('refused when the target is past, the row is synced or superseded, or the user is readonly', async () => {
    const { app } = setup({
      now: new Date('2027-12-23T15:00:00Z'),
      syncs: [sync({ status: 'failed' }), sync({ id: 2, status: 'synced', targetTrialEnd: '2028-02-01T05:00:00.000Z' }), sync({ id: 3, status: 'superseded', targetTrialEnd: '2028-02-01T05:00:00.000Z' })]
    });
    expect((await send(app, 1)).body.details.code).toBe('sync_target_past');
    expect((await send(app, 2)).body.details.code).toBe('sync_not_resendable');
    expect((await send(app, 3)).body.details.code).toBe('sync_not_resendable');
    const readonly = setup({ identity: READONLY, syncs: [sync({ status: 'failed' })] });
    expect((await send(readonly.app, 1, {}, token(9))).status).toBe(403);
    expect(readonly.syncsRepository.reopen).not.toHaveBeenCalled();
  });
});
