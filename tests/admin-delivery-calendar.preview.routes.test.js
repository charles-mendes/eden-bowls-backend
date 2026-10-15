const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');
const { DeliveryCalendarImpactService, prepMidnight } = require('../src/services/delivery-calendar-impact.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = (userId = 7) => issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const ADMIN = { userId: '7', email: 'admin@edenbowls.com', roles: ['admin'], permissions: ROLE_PERMISSIONS.admin };
const READONLY = { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR', 'US'] };
const NOW = new Date('2027-12-10T15:00:00Z');

function subscription(overrides = {}) {
  return {
    stripeSubscriptionId: 'sub_1', ledgerId: 1, userId: 70, market: 'US', status: 'active',
    chargeAt: new Date('2027-12-20T15:00:00Z'), termMonths: 1, chargedCount: null, transitDays: 1,
    productionStatus: 'to_prepare', pendingDeliveryChanges: null, paidCycle: null, ...overrides
  };
}

function setup({ identity = ADMIN, subscriptions = [subscription()], existing = [] } = {}) {
  const calendarRepository = {
    listActive: jest.fn().mockResolvedValue(existing.filter((row) => row.active)),
    listYear: jest.fn().mockResolvedValue(existing),
    findById: jest.fn(async (id) => existing.find((row) => row.id === id) || null),
    insertIgnore: jest.fn(),
    deleteOne: jest.fn()
  };
  const listForMarket = jest.fn().mockResolvedValue(subscriptions);
  const service = new AdminDeliveryCalendarService({
    calendarRepository,
    impactService: new DeliveryCalendarImpactService({ subscriptions: { listForMarket }, now: () => NOW }),
    now: () => NOW
  });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminDeliveryCalendarService: service
  });
  return { app, calendarRepository, listForMarket };
}

const adhoc = (closedOn, flags = {}) => ({
  market: 'US', type: 'adhoc', label: 'Manutenção', closedOn,
  closesPreparation: true, closesPickup: true, closesDelivery: true, ...flags
});

describe('POST /api/v1/admin/delivery-calendar/preview', () => {
  test('lists the affected subscriptions and how each moves', async () => {
    const trialing = subscription({ stripeSubscriptionId: 'sub_2', status: 'trialing', chargeAt: prepMidnight('2027-12-21', 'America/New_York') });
    const { app, calendarRepository } = setup({ subscriptions: [subscription(), trialing] });
    const response = await request(app).post('/api/v1/admin/delivery-calendar/preview')
      .set('Authorization', `Bearer ${token()}`).send(adhoc('2027-12-21'));
    expect(response.status).toBe(200);
    expect(response.body.affected.map((item) => [item.stripeSubscriptionId, item.move, item.locked])).toEqual([
      ['sub_1', 'projection_only', false],
      ['sub_2', 'stripe_sync', false]
    ]);
    expect(response.body.change).toMatchObject({ type: 'adhoc', closedOn: '2027-12-21', active: true });
    expect(calendarRepository.insertIgnore).not.toHaveBeenCalled();
    expect(calendarRepository.deleteOne).not.toHaveBeenCalled();
  });

  test('marks a locked delivery', async () => {
    const { app } = setup({ subscriptions: [subscription({ productionStatus: 'in_production' })] });
    const response = await request(app).post('/api/v1/admin/delivery-calendar/preview')
      .set('Authorization', `Bearer ${token()}`).send(adhoc('2027-12-21'));
    expect(response.body.affected).toEqual([expect.objectContaining({ locked: true, lockReason: 'in_production' })]);
  });

  test('no affected delivery, and short notice at 6 days but not at 7', async () => {
    const { app } = setup();
    const six = await request(app).post('/api/v1/admin/delivery-calendar/preview')
      .set('Authorization', `Bearer ${token()}`).send(adhoc('2027-12-16'));
    expect(six.body).toMatchObject({ affected: [], shortNotice: true });
    const seven = await request(app).post('/api/v1/admin/delivery-calendar/preview')
      .set('Authorization', `Bearer ${token()}`).send(adhoc('2027-12-17'));
    expect(seven.body.shortNotice).toBe(false);
  });

  test('turning a flag off previews nothing to move', async () => {
    const row = { id: 4, market: 'US', closedOn: '2027-12-21', label: 'Manutenção', origin: 'one_off', type: 'adhoc', active: true, closesPreparation: true, closesPickup: true, closesDelivery: true };
    const { app, listForMarket } = setup({ existing: [row] });
    const response = await request(app).post('/api/v1/admin/delivery-calendar/preview')
      .set('Authorization', `Bearer ${token()}`).send({ market: 'US', id: 4, closesPickup: false });
    expect(response.status).toBe(200);
    expect(response.body.affected).toEqual([]);
    expect(listForMarket).not.toHaveBeenCalled();
  });

  test('refuses invalid changes and readonly', async () => {
    const { app } = setup({ existing: [{ id: 1, market: 'US', closedOn: '2027-12-21', type: 'adhoc', active: true }] });
    const send = (body, user = token()) => request(app).post('/api/v1/admin/delivery-calendar/preview').set('Authorization', `Bearer ${user}`).send(body);
    expect((await send(adhoc('2027-12-22', { closesPreparation: false, closesPickup: false, closesDelivery: false }))).body.details.code).toBe('flag_required');
    expect((await send({ ...adhoc('2027-12-22'), type: 'national' })).body.details.code).toBe('type_not_allowed');
    expect((await send({ ...adhoc('2027-12-22'), market: 'BR', type: 'carrier' })).body.details.code).toBe('type_not_allowed');
    expect((await send(adhoc('2027-12-21'))).status).toBe(409);
    const readonly = setup({ identity: READONLY });
    const refused = await request(readonly.app).post('/api/v1/admin/delivery-calendar/preview').set('Authorization', `Bearer ${token(9)}`).send(adhoc('2027-12-21'));
    expect(refused.status).toBe(403);
  });
});
