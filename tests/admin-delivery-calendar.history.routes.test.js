const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = (userId) => issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const READONLY = { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR', 'US'] };
const OPERATOR_BR = { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR'] };

const REMOVED = {
  id: 12,
  actorUserId: 8,
  actorEmail: 'op@edenbowls.com',
  action: 'delivery_calendar.remove',
  metadata: { market: 'BR', closedOn: '2027-03-29', type: 'regional', label: 'Aniversário de Curitiba', before: { active: true, closesPreparation: true, closesPickup: true, closesDelivery: true }, after: null, moved: [], syncIds: [] },
  createdAt: '2027-03-20T12:00:00.000Z'
};

function appFor(identity, auditRepository) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminDeliveryCalendarService: new AdminDeliveryCalendarService({ calendarRepository: {}, auditRepository })
  });
}

describe('GET /api/v1/admin/delivery-calendar/history', () => {
  test('readonly reads the history of a market and year, a removed row included', async () => {
    const auditRepository = { listDeliveryCalendar: jest.fn().mockResolvedValue([REMOVED]) };
    const response = await request(appFor(READONLY, auditRepository))
      .get('/api/v1/admin/delivery-calendar/history?market=BR&year=2027')
      .set('Authorization', `Bearer ${token(9)}`);
    expect(response.status).toBe(200);
    expect(auditRepository.listDeliveryCalendar).toHaveBeenCalledWith({ market: 'BR', year: 2027 });
    expect(response.body.items[0].metadata).toMatchObject({ closedOn: '2027-03-29', type: 'regional', label: 'Aniversário de Curitiba', before: { closesPickup: true } });
  });

  test('a session scoped to BR cannot read the US history', async () => {
    const auditRepository = { listDeliveryCalendar: jest.fn() };
    const response = await request(appFor(OPERATOR_BR, auditRepository))
      .get('/api/v1/admin/delivery-calendar/history?market=US&year=2027')
      .set('Authorization', `Bearer ${token(8)}`);
    expect(response.status).toBe(403);
    expect(auditRepository.listDeliveryCalendar).not.toHaveBeenCalled();
  });
});
