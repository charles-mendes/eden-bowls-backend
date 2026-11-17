const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const auth = (req) => req.set('Authorization', `Bearer ${token()}`);
const admin = { userId: '7', email: 'ops@edenbowls.com', roles: ['admin'], permissions: ROLE_PERMISSIONS.admin };
const readOnly = { userId: '8', email: 'read@edenbowls.com', roles: ['viewer'], markets: ['US'], permissions: ['shipping.read'] };

function appWith(upsPickupService, identity = admin) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    upsPickupService
  });
}

describe('UPS pickup routes', () => {
  test('lists with from', async () => {
    const list = jest.fn().mockResolvedValue({ success: true, data: { items: [], from: '2026-11-01' } });
    const response = await auth(request(appWith({ list })).get('/api/v1/admin/shipments/pickups?from=2026-11-01'));
    expect(response.status).toBe(200);
    expect(list.mock.calls[0][1]).toEqual({ from: '2026-11-01' });
  });

  test('requests with the body', async () => {
    const requestPickup = jest.fn().mockResolvedValue({ success: true, data: { pickup: { id: 9 } } });
    const payload = { pickup_date: '2026-11-09', ready_time: '14:00', close_time: '18:00', package_count: 8, shipment_ids: [1, 2] };
    const response = await auth(request(appWith({ request: requestPickup })).post('/api/v1/admin/shipments/pickups')).send(payload);
    expect(response.status).toBe(200);
    expect(requestPickup.mock.calls[0][0]).toMatchObject({ body: payload, actor: { email: 'ops@edenbowls.com' } });
  });

  test('codes and details reach the response', async () => {
    const requestPickup = jest.fn().mockRejectedValue(new HttpError(422, 'No.', { code: 'pickup_shipment_not_eligible', shipment_ids: [3] }));
    const response = await auth(request(appWith({ request: requestPickup })).post('/api/v1/admin/shipments/pickups')).send({});
    expect(response.status).toBe(422);
    expect(response.body.details).toEqual({ code: 'pickup_shipment_not_eligible', shipment_ids: [3] });
  });

  test('cancel and not-created pass the id', async () => {
    const service = {
      cancel: jest.fn().mockResolvedValue({ success: true, data: {} }),
      markNotCreated: jest.fn().mockResolvedValue({ success: true, data: {} })
    };
    const app = appWith(service);
    await auth(request(app).post('/api/v1/admin/shipments/pickups/9/cancel')).send({});
    await auth(request(app).post('/api/v1/admin/shipments/pickups/9/not-created')).send({});
    expect(service.cancel.mock.calls[0][0]).toBe('9');
    expect(service.markNotCreated.mock.calls[0][0]).toBe('9');
  });

  test.each([
    ['post', '/api/v1/admin/shipments/pickups'],
    ['post', '/api/v1/admin/shipments/pickups/9/cancel'],
    ['post', '/api/v1/admin/shipments/pickups/9/not-created']
  ])('read-only staff get 403 on %s %s', async (method, path) => {
    const service = { request: jest.fn(), cancel: jest.fn(), markNotCreated: jest.fn(), list: jest.fn() };
    const response = await auth(request(appWith(service, readOnly))[method](path)).send({});
    expect(response.status).toBe(403);
    expect(service.request).not.toHaveBeenCalled();
    expect(service.cancel).not.toHaveBeenCalled();
    expect(service.markNotCreated).not.toHaveBeenCalled();
  });
});
