const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

const IDENTITIES = {
  admin: { userId: '7', email: 'admin@edenbowls.com', roles: ['admin'], permissions: ROLE_PERMISSIONS.admin },
  readonly: { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR', 'US'] },
  operatorBr: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR'] }
};

const US_2027 = [
  { id: 1, market: 'US', closedOn: '2027-12-24', label: 'Christmas Eve', origin: 'ups', type: 'carrier', active: true, closesPreparation: false, closesPickup: true, closesDelivery: false },
  { id: 2, market: 'US', closedOn: '2027-12-25', label: 'Christmas Day', origin: 'ups', type: 'carrier', active: false, closesPreparation: true, closesPickup: true, closesDelivery: true }
];

function appFor(identity, calendarRepository) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminDeliveryCalendarService: new AdminDeliveryCalendarService({ calendarRepository })
  });
}

function repository(rows = US_2027) {
  return { listYear: jest.fn().mockResolvedValue(rows) };
}

describe('GET /api/v1/admin/delivery-calendar', () => {
  test('lists the rows of one market and year with type, active, and the three flags', async () => {
    const calendar = repository();
    const response = await request(appFor(IDENTITIES.admin, calendar))
      .get('/api/v1/admin/delivery-calendar?market=US&year=2027')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(200);
    expect(calendar.listYear).toHaveBeenCalledWith('US', 2027);
    expect(response.body).toEqual({ market: 'US', year: 2027, items: US_2027 });
    expect(response.body.items[1].active).toBe(false);
  });

  test('an empty year returns no items and no error', async () => {
    const response = await request(appFor(IDENTITIES.admin, repository([])))
      .get('/api/v1/admin/delivery-calendar?market=BR&year=2031')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  test('readonly can list', async () => {
    const response = await request(appFor(IDENTITIES.readonly, repository()))
      .get('/api/v1/admin/delivery-calendar?market=US&year=2027')
      .set('Authorization', `Bearer ${tokenFor(9)}`);
    expect(response.status).toBe(200);
  });

  test('a session scoped to BR is refused for US', async () => {
    const calendar = repository();
    const response = await request(appFor(IDENTITIES.operatorBr, calendar))
      .get('/api/v1/admin/delivery-calendar?market=US&year=2027')
      .set('Authorization', `Bearer ${tokenFor(8)}`);
    expect(response.status).toBe(403);
    expect(calendar.listYear).not.toHaveBeenCalled();
  });

  test('a market and a valid year are required', async () => {
    const calendar = repository();
    const noMarket = await request(appFor(IDENTITIES.admin, calendar))
      .get('/api/v1/admin/delivery-calendar?year=2027')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(noMarket.status).toBe(422);
    const badYear = await request(appFor(IDENTITIES.admin, calendar))
      .get('/api/v1/admin/delivery-calendar?market=US&year=abc')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(badYear.status).toBe(422);
    expect(calendar.listYear).not.toHaveBeenCalled();
  });

  test('a session scoped to BR lists BR without naming the market', async () => {
    const calendar = repository([]);
    const response = await request(appFor(IDENTITIES.operatorBr, calendar))
      .get('/api/v1/admin/delivery-calendar?year=2027')
      .set('Authorization', `Bearer ${tokenFor(8)}`);
    expect(response.status).toBe(200);
    expect(calendar.listYear).toHaveBeenCalledWith('BR', 2027);
  });
});
