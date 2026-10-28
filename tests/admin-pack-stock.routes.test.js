const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminPackStockService } = require('../src/services/admin-pack-stock.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken(
    { data: { user: { id: 7 } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function stockApp(adminPackStockService, role = 'operator') {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'kitchen@edenbowls.com',
        roles: [role],
        markets: ['BR'],
        permissions: ROLE_PERMISSIONS[role]
      })
    },
    adminPackStockService
  });
}

describe('admin pack stock routes', () => {
  test('Readonly cannot record', async () => {
    const service = { recordProduction: jest.fn() };

    const response = await request(stockApp(service, 'readonly'))
      .post('/api/v1/admin/stock/production')
      .set('Authorization', `Bearer ${token()}`)
      .send({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, quantity: 10 });

    expect(response.status).toBe(403);
    expect(service.recordProduction).not.toHaveBeenCalled();
  });

  test('readonly still reads the overview', async () => {
    const service = { overview: jest.fn().mockResolvedValue({ market: 'BR', windowDays: 7, items: [], unsizedLines: [] }) };

    const response = await request(stockApp(service, 'readonly'))
      .get('/api/v1/admin/stock?market=BR&windowDays=14')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(service.overview.mock.calls[0][0]).toEqual({ market: 'BR', windowDays: 14 });
  });

  test('Invalid window', async () => {
    const service = { overview: jest.fn() };

    const response = await request(stockApp(service))
      .get('/api/v1/admin/stock?market=BR&windowDays=10')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: 'invalid_window_days' });
    expect(service.overview).not.toHaveBeenCalled();
  });

  test('History of one item', async () => {
    const stockRepository = {
      listMovements: jest.fn().mockResolvedValue({
        total: 2,
        items: [
          { id: 2, flavorKey: 'frango', packSizeGrams: 300, type: 'separation', quantity: -4 },
          { id: 1, flavorKey: 'frango', packSizeGrams: 300, type: 'production', quantity: 30 }
        ]
      })
    };
    const service = new AdminPackStockService({ stockRepository });

    const response = await request(stockApp(service))
      .get('/api/v1/admin/stock/movements?market=BR&flavorKey=frango&packSizeGrams=300&page=1&perPage=20')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(stockRepository.listMovements).toHaveBeenCalledWith(
      { market: 'BR', flavorKey: 'frango', packSizeGrams: 300, type: undefined },
      expect.objectContaining({ page: 1, perPage: 20, offset: 0 })
    );
    expect(response.body).toMatchObject({ total: 2, page: 1 });
    expect(response.body.items.map((item) => item.id)).toEqual([2, 1]);
  });

  test('an adjustment with reason other needs a note', async () => {
    const service = { recordAdjustment: jest.fn() };

    const response = await request(stockApp(service))
      .post('/api/v1/admin/stock/adjustments')
      .set('Authorization', `Bearer ${token()}`)
      .send({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, quantity: -2, reason: 'other' });

    expect(response.status).toBe(400);
    expect(service.recordAdjustment).not.toHaveBeenCalled();
  });

  test('sets and clears the minimum level', async () => {
    const service = { setMinimum: jest.fn().mockResolvedValue({ minLevel: null }) };

    const response = await request(stockApp(service))
      .put('/api/v1/admin/stock/minimum')
      .set('Authorization', `Bearer ${token()}`)
      .send({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, minLevel: null });

    expect(response.status).toBe(200);
    expect(service.setMinimum.mock.calls[0][0]).toMatchObject({ minLevel: null });
  });
});
