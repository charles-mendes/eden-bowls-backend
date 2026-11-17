const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');
const { DeliveryCalendarImpactService } = require('../src/services/delivery-calendar-impact.service');
const { DEFAULT_OPERATING_WEEK, weekOf } = require('../src/core/delivery-closed-days');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = (userId = 8) => issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const OPERATOR_BR = { userId: '8', email: 'op.br@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR'] };
const READONLY_BR = { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR'] };

function setup({ identity = OPERATOR_BR } = {}) {
  const manager = { query: jest.fn() };
  const stored = { ...DEFAULT_OPERATING_WEEK };
  const weekRepository = {
    get: jest.fn(async (market) => stored[market]),
    saveIn: jest.fn(async (_manager, market, days) => { stored[market] = days; return days; })
  };
  const calendarRepository = {
    snapshot: jest.fn(async () => ({ rows: [], week: { ...stored } })),
    listActive: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null)
  };
  const service = new AdminDeliveryCalendarService({
    calendarRepository,
    weekRepository,
    impactService: new DeliveryCalendarImpactService({ subscriptions: { listForMarket: async () => [] }, now: () => new Date('2026-11-17T15:00:00Z') }),
    syncsRepository: { insertPending: jest.fn(), linkAuditEvent: jest.fn() },
    ledgerRepository: { rewritePendingChargeMove: jest.fn() },
    auditRepository: { createIn: jest.fn().mockResolvedValue(9001) },
    dataSource: { transaction: (work) => work(manager) }
  });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminDeliveryCalendarService: service
  });
  return { app, weekRepository, calendarRepository };
}

const auth = (req) => req.set('Authorization', `Bearer ${token()}`);
const MONDAY_TO_FRIDAY = weekOf([1, 2, 3, 4, 5]);

describe('standard week endpoints', () => {
  test('Reading the week of a market', async () => {
    const { app } = setup({ identity: READONLY_BR });
    const response = await auth(request(app).get('/api/v1/admin/delivery-calendar/week').query({ market: 'BR' }));
    expect(response.status).toBe(200);
    const data = response.body.data || response.body;
    expect(data.timeZone).toBe('America/Sao_Paulo');
    expect(data.days.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(data.days[0]).toEqual({ weekday: 1, open: true, opensAt: '09:00', closesAt: '20:00' });
  });

  test('preview and save need production.write', async () => {
    const { app, weekRepository } = setup({ identity: READONLY_BR });
    const preview = await auth(request(app).post('/api/v1/admin/delivery-calendar/week/preview').query({ market: 'BR' }).send({ days: MONDAY_TO_FRIDAY }));
    const save = await auth(request(app).put('/api/v1/admin/delivery-calendar/week').query({ market: 'BR' }).send({ days: MONDAY_TO_FRIDAY, confirmedMoves: [] }));
    expect(preview.status).toBe(403);
    expect(save.status).toBe(403);
    expect(weekRepository.saveIn).not.toHaveBeenCalled();
  });

  test('the operator previews and saves the week of their market', async () => {
    const { app, weekRepository } = setup();
    const preview = await auth(request(app).post('/api/v1/admin/delivery-calendar/week/preview').query({ market: 'BR' }).send({ days: MONDAY_TO_FRIDAY }));
    expect(preview.status).toBe(200);
    const previewed = preview.body.data || preview.body;
    expect(previewed).toMatchObject({ market: 'BR', impact: [], confirmedMoves: [] });

    const save = await auth(request(app).put('/api/v1/admin/delivery-calendar/week').query({ market: 'BR' }).send({ days: MONDAY_TO_FRIDAY, confirmedMoves: [] }));
    expect(save.status).toBe(200);
    expect(weekRepository.saveIn).toHaveBeenCalledWith(expect.anything(), 'BR', MONDAY_TO_FRIDAY);
  });

  test('Brazil operator and the United States week', async () => {
    const { app, weekRepository } = setup();
    const response = await auth(request(app).put('/api/v1/admin/delivery-calendar/week').query({ market: 'US' }).send({ days: weekOf([1, 2, 3, 4]), confirmedMoves: [] }));
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).toContain('market_forbidden');
    expect(weekRepository.saveIn).not.toHaveBeenCalled();
  });

  test('PATCH /week is not taken as a closed day id', async () => {
    const { app, calendarRepository } = setup();
    const response = await auth(request(app).patch('/api/v1/admin/delivery-calendar/week').query({ market: 'BR' }).send({ active: false }));
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('invalid_id');
    expect(calendarRepository.findById).not.toHaveBeenCalled();
  });
});
