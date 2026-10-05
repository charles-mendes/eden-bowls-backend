const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');
const { DeliveryCalendarImpactService, prepMidnight } = require('../src/services/delivery-calendar-impact.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = (userId = 8) => issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const OPERATOR = { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['US'] };
const READONLY = { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['US'] };
const NOW = new Date('2027-12-10T15:00:00Z');
const TZ = 'America/New_York';
const ROW = { id: 4, market: 'US', closedOn: '2027-12-21', label: 'Manutenção', origin: 'one_off', type: 'adhoc', active: true, closesPreparation: true, closesPickup: true, closesDelivery: true };
const NATIONAL = { ...ROW, id: 5, type: 'national', origin: 'fixed' };

function subscription(overrides = {}) {
  return {
    stripeSubscriptionId: 'sub_1', ledgerId: 1, userId: 70, market: 'US', status: 'trialing',
    chargeAt: prepMidnight('2027-12-22', TZ), termMonths: 1, chargedCount: null, transitDays: 1,
    productionStatus: 'to_prepare', pendingDeliveryChanges: null, paidCycle: null, ...overrides
  };
}

function setup({ identity = OPERATOR, subscriptions = [subscription()], existing = [ROW, NATIONAL] } = {}) {
  const manager = { query: jest.fn() };
  const calendarRepository = {
    listActive: jest.fn().mockResolvedValue(existing.filter((row) => row.active)),
    listYear: jest.fn().mockResolvedValue(existing),
    findById: jest.fn(async (id) => existing.find((row) => row.id === id) || null),
    insertRow: jest.fn(async (_m, row) => ({ ...row, id: 99 })),
    updateRow: jest.fn(async (_m, row) => row),
    deleteRow: jest.fn()
  };
  const syncsRepository = { insertPending: jest.fn().mockResolvedValue(501), linkAuditEvent: jest.fn() };
  const auditRepository = { createIn: jest.fn().mockResolvedValue(9001) };
  const service = new AdminDeliveryCalendarService({
    calendarRepository,
    impactService: new DeliveryCalendarImpactService({ subscriptions: { listForMarket: async () => subscriptions }, now: () => NOW }),
    syncsRepository,
    ledgerRepository: { rewritePendingChargeMove: jest.fn() },
    auditRepository,
    dataSource: { transaction: (work) => work(manager) },
    now: () => NOW
  });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminDeliveryCalendarService: service
  });
  return { app, calendarRepository, syncsRepository, auditRepository };
}

const closure = (closedOn) => ({
  market: 'US', type: 'adhoc', label: 'Falta de energia', closedOn,
  closesPreparation: true, closesPickup: true, closesDelivery: true
});

describe('calendar write endpoints', () => {
  test('POST moves the affected delivery, queues its sync, and records the event', async () => {
    const { app, calendarRepository, syncsRepository, auditRepository } = setup();
    const response = await request(app).post('/api/v1/admin/delivery-calendar')
      .set('Authorization', `Bearer ${token()}`).send(closure('2027-12-22'));
    expect(response.status).toBe(200);
    expect(response.body.row).toMatchObject({ id: 99, type: 'adhoc', closedOn: '2027-12-22' });
    expect(response.body.affected).toEqual([expect.objectContaining({ stripeSubscriptionId: 'sub_1', move: 'stripe_sync', newPreparationDay: '2027-12-27' })]);
    expect(calendarRepository.insertRow).toHaveBeenCalled();
    expect(syncsRepository.insertPending).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetTrialEnd: prepMidnight('2027-12-27', TZ).toISOString() }));
    expect(auditRepository.createIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'delivery_calendar.create', actorEmail: 'op@edenbowls.com' }));
  });

  test('POST over a locked delivery is refused with the subscription named', async () => {
    const { app, calendarRepository, auditRepository } = setup({ subscriptions: [subscription({ productionStatus: 'blocked' })] });
    const response = await request(app).post('/api/v1/admin/delivery-calendar')
      .set('Authorization', `Bearer ${token()}`).send(closure('2027-12-22'));
    expect(response.status).toBe(409);
    expect(response.body.details).toMatchObject({ code: 'delivery_locked', subscriptions: [{ stripeSubscriptionId: 'sub_1', lockReason: 'blocked' }] });
    expect(calendarRepository.insertRow).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
  });

  test('POST validation and conflict errors', async () => {
    const { app } = setup();
    const send = (body) => request(app).post('/api/v1/admin/delivery-calendar').set('Authorization', `Bearer ${token()}`).send(body);
    expect((await send({ ...closure('2027-12-23'), closesPreparation: false, closesPickup: false, closesDelivery: false })).body.details.code).toBe('flag_required');
    expect((await send({ ...closure('2027-12-23'), type: 'national' })).body.details.code).toBe('type_not_allowed');
    const conflict = await send({ ...closure('2027-12-21') });
    expect(conflict.status).toBe(409);
    expect(conflict.body.details.code).toBe('closed_day_conflict');
  });

  test('PATCH changes flags and active; DELETE removes regional and adhoc rows only', async () => {
    const { app, calendarRepository, auditRepository } = setup({ subscriptions: [] });
    const patch = await request(app).patch('/api/v1/admin/delivery-calendar/4')
      .set('Authorization', `Bearer ${token()}`).send({ market: 'US', active: false });
    expect(patch.status).toBe(200);
    expect(calendarRepository.updateRow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 4, active: false }));
    expect(auditRepository.createIn.mock.calls[0][1].action).toBe('delivery_calendar.deactivate');

    const removed = await request(app).delete('/api/v1/admin/delivery-calendar/4?market=US').set('Authorization', `Bearer ${token()}`);
    expect(removed.status).toBe(200);
    expect(calendarRepository.deleteRow).toHaveBeenCalledWith(expect.anything(), 4);

    const national = await request(app).delete('/api/v1/admin/delivery-calendar/5?market=US').set('Authorization', `Bearer ${token()}`);
    expect(national.status).toBe(422);
    expect(national.body.details.code).toBe('national_not_removable');
    expect(calendarRepository.deleteRow).toHaveBeenCalledTimes(1);
  });

  test('readonly is refused on every write', async () => {
    const { app, calendarRepository } = setup({ identity: READONLY });
    const auth = `Bearer ${token(9)}`;
    expect((await request(app).post('/api/v1/admin/delivery-calendar').set('Authorization', auth).send(closure('2027-12-22'))).status).toBe(403);
    expect((await request(app).patch('/api/v1/admin/delivery-calendar/4').set('Authorization', auth).send({ market: 'US', active: false })).status).toBe(403);
    expect((await request(app).delete('/api/v1/admin/delivery-calendar/4?market=US').set('Authorization', auth)).status).toBe(403);
    expect(calendarRepository.insertRow).not.toHaveBeenCalled();
    expect(calendarRepository.updateRow).not.toHaveBeenCalled();
    expect(calendarRepository.deleteRow).not.toHaveBeenCalled();
  });
});
